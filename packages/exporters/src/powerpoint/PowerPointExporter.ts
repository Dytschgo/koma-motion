import { DEFAULT_KOMA_HOLD_DURATION_MS, komaHoldDurationSchema } from '@koma-motion/core';
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  getCanvasSize,
  komaProjectSchema,
  type AssetReference,
  type GroupElement,
  type KomaElement,
  type KomaProject,
  type KomaTransition,
  type LeafElement,
} from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import JSZip from 'jszip';
import { imageSize } from 'image-size';
import pptxgen from 'pptxgenjs';
import type {
  ExportDestination,
  ExportIssue,
  ExportResult,
  ExportValidationResult,
  ExporterAvailability,
  PresentationExporter,
} from '../types';

const HEIGHT = 7.5;
const POINTS_PER_UNIT = (HEIGHT * 72) / 1080;
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';

interface Placed {
  element: LeafElement;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
}

function issue(severity: 'error' | 'warning', code: string, message: string): ExportIssue {
  return { severity, code, message };
}

function sorted<T extends { zIndex: number }>(elements: readonly T[]): T[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index)
    .map(({ element }) => element);
}

function childGeometry(group: GroupElement, child: LeafElement): Placed {
  const sx = group.size.width / group.content.referenceSize.width;
  const sy = group.size.height / group.content.referenceSize.height;
  const w = child.size.width * sx;
  const h = child.size.height * sy;
  const centerX = group.position.x + (child.position.x + child.size.width / 2) * sx;
  const centerY = group.position.y + (child.position.y + child.size.height / 2) * sy;
  const pivotX = group.position.x + group.size.width / 2;
  const pivotY = group.position.y + group.size.height / 2;
  const angle = (group.rotation * Math.PI) / 180;
  const dx = centerX - pivotX;
  const dy = centerY - pivotY;
  return {
    element: child,
    x: pivotX + dx * Math.cos(angle) - dy * Math.sin(angle) - w / 2,
    y: pivotY + dx * Math.sin(angle) + dy * Math.cos(angle) - h / 2,
    w,
    h,
    rotation: group.rotation + child.rotation,
    opacity: group.opacity * child.opacity,
  };
}

function placedElements(elements: readonly KomaElement[]): Placed[] {
  return sorted(elements).flatMap((element) => {
    if (!element.visible) return [];
    if (element.type === 'group') {
      return sorted(element.content.children)
        .filter((child) => child.visible)
        .map((child) => childGeometry(element, child));
    }
    return [
      {
        element,
        x: element.position.x,
        y: element.position.y,
        w: element.size.width,
        h: element.size.height,
        rotation: element.rotation,
        opacity: element.opacity,
      },
    ];
  });
}

function colour(value: string): string {
  return value.slice(1).toUpperCase();
}

function imageData(asset: AssetReference | undefined): string | null {
  if (!asset?.embeddedData || asset.mediaType === 'image/webp') return null;
  const data = asset.embeddedData.data;
  if (!data || data.length % 4 !== 0) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) return null;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const gifHeader = bytes.subarray(0, 6).toString('ascii');
  const gif = gifHeader === 'GIF87a' || gifHeader === 'GIF89a';
  try {
    const dimensions = imageSize(bytes);
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width * dimensions.height > 40_000_000
    )
      return null;
    if (png && !validPngData(bytes)) return null;
    if (jpeg && (bytes.at(-2) !== 255 || bytes.at(-1) !== 217)) return null;
    if (gif && bytes.at(-1) !== 59) return null;
  } catch {
    return null;
  }
  if (
    (asset.mediaType === 'image/png' && png) ||
    (asset.mediaType === 'image/jpeg' && jpeg) ||
    (asset.mediaType === 'image/gif' && gif)
  ) {
    return `data:${asset.mediaType};base64,${data}`;
  }
  return null;
}

function validPngData(bytes: Buffer): boolean {
  if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const chunks: Buffer[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || chunks.length === 0 || offset !== bytes.length) return false;
  try {
    inflateSync(Buffer.concat(chunks), { maxOutputLength: 64 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

type ImageResolver = (assetId: string) => string | null;

/** Verification is shared by warnings and placement, and retained only for this request. */
function createImageResolver(project: KomaProject): ImageResolver {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const verified = new Map<AssetReference, string | null>();
  return (assetId) => {
    const asset = assets.get(assetId);
    if (asset === undefined) return null;
    if (!verified.has(asset)) verified.set(asset, imageData(asset));
    return verified.get(asset) ?? null;
  };
}

function fidelityWarnings(project: KomaProject, resolveImage: ImageResolver): ExportIssue[] {
  const warnings: ExportIssue[] = [];
  for (const koma of project.presentation.komas) {
    for (const placed of placedElements(koma.elements)) {
      const { element } = placed;
      if (element.type === 'image' && resolveImage(element.content.assetId) === null) {
        warnings.push(
          issue(
            'warning',
            'imageUnavailable',
            `Image "${element.name}" in Koma "${koma.title}" will appear as a placeholder.`,
          ),
        );
      }
      if (element.type === 'image' && element.style.cornerRadius > 0) {
        warnings.push(
          issue(
            'warning',
            'imageCornerRadius',
            `Rounded corners on image "${element.name}" are not preserved.`,
          ),
        );
      }
      if (
        element.type === 'text' &&
        element.style.fontWeight !== 400 &&
        element.style.fontWeight !== 700
      ) {
        warnings.push(
          issue(
            'warning',
            'fontWeightApproximation',
            `Text "${element.name}" uses weight ${element.style.fontWeight}; PowerPoint export approximates it as regular or bold.`,
          ),
        );
      }
    }
    for (const element of koma.elements) {
      if (element.type !== 'group' || !element.visible) continue;
      warnings.push(
        issue(
          'warning',
          'groupFlattened',
          `Group "${element.name}" is exported as individually editable objects.`,
        ),
      );
      const sx = element.size.width / element.content.referenceSize.width;
      const sy = element.size.height / element.content.referenceSize.height;
      if (Math.abs(sx - sy) > 1e-6) {
        warnings.push(
          issue(
            'warning',
            'groupSkew',
            `Group "${element.name}" has unequal scaling; text, strokes and rotated children may differ.`,
          ),
        );
      }
    }
  }
  return warnings;
}

function addPlaced(
  slide: pptxgen.Slide,
  pptx: pptxgen,
  placed: Placed,
  scale: number,
  resolveImage: ImageResolver,
): void {
  const { element, x, y, w, h, opacity } = placed;
  const box = { x: x * scale, y: y * scale, w: w * scale, h: h * scale };
  const rotate = ((placed.rotation % 360) + 360) % 360;
  const transparency = (1 - opacity) * 100;
  const groupScale = Math.min(w / element.size.width, h / element.size.height);
  const objectName = `!!${element.persistentId}`;
  if (element.type === 'text') {
    slide.addText(element.content.text, {
      ...box,
      objectName,
      rotate,
      isTextBox: true,
      margin: 0,
      fit: 'none',
      fontFace: element.style.fontFamily,
      fontSize: element.style.fontSize * POINTS_PER_UNIT * (h / element.size.height),
      bold: element.style.fontWeight >= 600,
      color: colour(element.style.colour),
      transparency,
      align: element.style.textAlign,
      valign: element.style.verticalAlign,
      lineSpacingMultiple: element.style.lineHeight,
    });
    return;
  }
  if (element.type === 'shape') {
    const kind = element.content.shape;
    const shape =
      kind === 'circle'
        ? pptx.ShapeType.ellipse
        : kind === 'roundedRectangle' && element.content.cornerRadius > 0
          ? pptx.ShapeType.roundRect
          : kind === 'line'
            ? pptx.ShapeType.line
            : pptx.ShapeType.rect;
    const lineColour = element.style.stroke ?? (kind === 'line' ? element.style.fill : null);
    slide.addShape(shape, {
      ...box,
      objectName,
      rotate,
      ...(kind === 'line' ? { y: (y + h / 2) * scale, h: 0 } : {}),
      ...(kind === 'roundedRectangle'
        ? {
            rectRadius:
              Math.min(Math.min(w, h) / 2, element.content.cornerRadius * groupScale) * scale,
          }
        : {}),
      fill:
        element.style.fill === null || kind === 'line'
          ? { color: 'FFFFFF', transparency: 100 }
          : { color: colour(element.style.fill), transparency },
      line:
        lineColour === null
          ? { color: '000000', transparency: 100, width: 0 }
          : {
              color: colour(lineColour),
              transparency,
              width: element.style.strokeWidth * POINTS_PER_UNIT * groupScale,
            },
    });
    return;
  }
  const data = resolveImage(element.content.assetId);
  if (data === null) {
    slide.addShape(pptx.ShapeType.rect, {
      ...box,
      objectName,
      rotate,
      fill: { color: 'EEEEEE', transparency },
      line: { color: '888888', width: 1, dashType: 'dash' },
    });
    slide.addText('Missing image', {
      ...box,
      rotate,
      margin: 0,
      fontFace: 'Arial',
      fontSize: 14,
      align: 'center',
      valign: 'middle',
      color: '333333',
    });
  } else {
    slide.addImage({
      ...box,
      objectName,
      rotate,
      transparency,
      data,
      altText: element.content.altText,
      sizing: { type: element.style.fit, w: box.w, h: box.h },
    });
  }
}

function transitionXml(mode: 'fade' | 'morph', duration: number, advance?: number): string {
  const click = advance === undefined ? 1 : 0;
  const advanceAttribute = advance === undefined ? '' : ` advTm="${advance}"`;
  const attrs = ` spd="slow" p14:dur="${duration}" advClick="${click}"${advanceAttribute}`;
  const fallbackAttrs = ` spd="slow" advClick="${click}"${advanceAttribute}`;
  const effect = mode === 'morph' ? '<p159:morph option="byObject"/>' : '<p:fade/>';
  return (
    `<mc:AlternateContent xmlns:mc="${MC}" xmlns:p14="${P14}"${mode === 'morph' ? ` xmlns:p159="${P159}"` : ''}>` +
    `<mc:Choice Requires="${mode === 'morph' ? 'p14 p159' : 'p14'}"><p:transition${attrs}>${effect}</p:transition></mc:Choice>` +
    `<mc:Fallback><p:transition${fallbackAttrs}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`
  );
}

function canMorph(
  transition: KomaTransition | undefined,
  playable: ReadonlySet<KomaTransition>,
): boolean {
  return (
    transition !== undefined &&
    playable.has(transition) &&
    transition.strategy === 'continuous' &&
    transition.elementTransitions.every(
      ({ operation }) =>
        operation !== 'replace' && operation !== 'fadeIn' && operation !== 'fadeOut',
    )
  );
}

async function addMotion(
  filePath: string,
  project: KomaProject,
  destination: ExportDestination,
  playable: ReadonlySet<KomaTransition>,
): Promise<void> {
  const mode = destination.motion ?? 'static';
  if (mode === 'static') return;
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const komas = project.presentation.komas;
  for (let index = 0; index < komas.length; index += 1) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const entry = zip.file(path);
    if (!entry) throw new Error(`Generated slide ${index + 1} is missing.`);
    const xml = await entry.async('string');
    if (xml.includes('<p:transition')) throw new Error('Generated slide already has a transition.');
    const inbound =
      index > 0
        ? project.presentation.transitions.find(
            (transition) =>
              transition.fromKomaId === komas[index - 1]?.id &&
              transition.toKomaId === komas[index]?.id,
          )
        : undefined;
    if (index === 0 && !destination.autoAdvance) continue;
    const effect = mode === 'morph' && canMorph(inbound, playable) ? 'morph' : 'fade';
    const duration = inbound && playable.has(inbound) ? inbound.duration : 500;
    const advance =
      komas[index]?.holdDurationMs ??
      destination.defaultHoldDurationMs ??
      DEFAULT_KOMA_HOLD_DURATION_MS;
    const transition = transitionXml(
      effect,
      duration,
      destination.autoAdvance && index < komas.length - 1 ? advance : undefined,
    );
    const anchor = xml.includes('</p:clrMapOvr>') ? '</p:clrMapOvr>' : '</p:cSld>';
    if (!xml.includes(anchor))
      throw new Error(`Generated slide ${index + 1} has an unknown structure.`);
    zip.file(path, xml.replace(anchor, `${anchor}${transition}`));
  }
  await writeFile(
    filePath,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
}

function prepareExport(project: KomaProject): {
  validation: ExportValidationResult;
  resolveImage: ImageResolver;
  playable: ReadonlySet<KomaTransition>;
} {
  const playable = new Set<KomaTransition>();
  const unavailable = (validation: ExportValidationResult) => ({
    validation,
    resolveImage: () => null,
    playable,
  });
  const parsed = komaProjectSchema.safeParse(project);
  if (!parsed.success) {
    return unavailable({
      exportable: false,
      issues: [
        issue(
          'error',
          'invalidProject',
          `Project is invalid: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`,
        ),
      ],
    });
  }
  if (project.presentation.komas.length === 0) {
    return unavailable({
      exportable: false,
      issues: [issue('error', 'emptyPresentation', 'Add a Koma before exporting.')],
    });
  }
  const resolveImage = createImageResolver(project);
  const issues = fidelityWarnings(project, resolveImage);
  for (const transition of project.presentation.transitions) {
    if (validateTransition(transition, project.presentation).length === 0) {
      playable.add(transition);
    } else {
      issues.push(
        issue(
          'warning',
          'invalidStoredMotion',
          `Stored motion for transition "${transition.id}" cannot be played. Static slides remain exportable; motion export uses a default slide fade.`,
        ),
      );
    }
  }
  return { validation: { exportable: true, issues }, resolveImage, playable };
}

export class PowerPointExporter implements PresentationExporter {
  readonly id = 'powerpoint';
  readonly displayName = 'PowerPoint';
  readonly fileExtension = 'pptx';
  readonly availability: ExporterAvailability = {
    status: 'available',
  };

  validate(project: KomaProject): Promise<ExportValidationResult> {
    return Promise.resolve(prepareExport(project).validation);
  }

  async export(project: KomaProject, destination: ExportDestination): Promise<ExportResult> {
    const { validation, resolveImage, playable } = prepareExport(project);
    if (!validation.exportable) {
      return {
        status: 'failed',
        message: 'The project cannot be exported.',
        issues: validation.issues,
      };
    }
    if (
      !isAbsolute(destination.filePath) ||
      !destination.filePath.toLowerCase().endsWith('.pptx')
    ) {
      return {
        status: 'failed',
        message: 'Choose a .pptx destination.',
        issues: [
          issue('error', 'invalidDestination', 'The destination must be an absolute .pptx path.'),
        ],
      };
    }
    const mode = destination.motion ?? 'static';
    if (mode !== 'static' && mode !== 'fade' && mode !== 'morph') {
      return {
        status: 'failed',
        message: 'Unknown motion mode.',
        issues: [issue('error', 'invalidMotion', 'Choose static, fade or morph export.')],
      };
    }
    if (
      destination.defaultHoldDurationMs !== undefined &&
      !komaHoldDurationSchema.safeParse(destination.defaultHoldDurationMs).success
    ) {
      return {
        status: 'failed',
        message: 'Choose a global hold duration between 1 and 60 seconds.',
        issues: [
          issue(
            'error',
            'invalidHoldDuration',
            'The global hold duration must be an integer from 1000 to 60000 milliseconds.',
          ),
        ],
      };
    }
    const warnings = [...validation.issues];
    if (mode !== 'static') {
      warnings.push(
        issue(
          'warning',
          'motionApproximation',
          `${mode === 'morph' ? 'PowerPoint Morph' : 'PowerPoint fade'} approximates Koma motion; easing, staged timing and per-element fades are not preserved.`,
        ),
      );
      if (mode === 'morph')
        warnings.push(
          issue(
            'warning',
            'morphCompatibility',
            'Morph requires a compatible PowerPoint version; older readers use a fade transition.',
          ),
        );
      for (const transition of project.presentation.transitions) {
        if (mode === 'morph' && playable.has(transition) && !canMorph(transition, playable)) {
          warnings.push(
            issue(
              'warning',
              'transitionFadeFallback',
              `Transition "${transition.id}" uses staged, replace or per-element fade motion and is exported as a slide fade.`,
            ),
          );
        }
      }
      const komas = project.presentation.komas;
      for (let index = 1; index < komas.length; index += 1) {
        if (
          !project.presentation.transitions.some(
            (transition) =>
              transition.fromKomaId === komas[index - 1]?.id &&
              transition.toKomaId === komas[index]?.id,
          )
        ) {
          warnings.push(
            issue(
              'warning',
              'missingTransition',
              `No stored transition connects Komas ${index} and ${index + 1}; a default slide fade is used.`,
            ),
          );
        }
      }
    } else if (project.presentation.transitions.length > 0) {
      warnings.push(
        issue('warning', 'motionOmitted', 'Koma motion is omitted from static slides.'),
      );
    }
    if (destination.autoAdvance && mode === 'static') {
      warnings.push(
        issue('warning', 'autoAdvanceIgnored', 'Automatic advance requires fade or Morph export.'),
      );
    }
    const temp = join(
      dirname(destination.filePath),
      `.${basename(destination.filePath)}.${randomUUID()}.tmp.pptx`,
    );
    try {
      const pptx = new pptxgen();
      const canvas = getCanvasSize(project.presentation.aspectRatio);
      pptx.defineLayout({
        name: 'KOMA',
        width: (HEIGHT * canvas.width) / canvas.height,
        height: HEIGHT,
      });
      pptx.layout = 'KOMA';
      pptx.author = 'Koma Motion';
      pptx.subject = project.presentation.objective;
      pptx.title = project.presentation.title;
      const scale = HEIGHT / canvas.height;
      for (const koma of project.presentation.komas) {
        const slide = pptx.addSlide();
        slide.background = { color: colour(koma.background.colour) };
        if (koma.speakerNotes) slide.addNotes(koma.speakerNotes);
        for (const placed of placedElements(koma.elements))
          addPlaced(slide, pptx, placed, scale, resolveImage);
      }
      await pptx.writeFile({ fileName: temp, compression: true });
      await addMotion(temp, project, destination, playable);
      await rename(temp, destination.filePath);
      return { status: 'exported', filePath: destination.filePath, warnings };
    } catch {
      return {
        status: 'failed',
        message: 'PowerPoint export failed. Check the destination and try again.',
        issues: [
          issue(
            'error',
            'writeFailed',
            'PowerPoint export failed; the destination was left unchanged.',
          ),
        ],
      };
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
}

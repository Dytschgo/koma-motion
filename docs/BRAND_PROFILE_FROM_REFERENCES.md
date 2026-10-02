# Create a Brand Kit and instructions from reference files

A brand profile is a Brand Kit together with matching project instructions.
This workflow proposes both from files you attach in the chat, lets you review
and edit them, and saves them as one reusable entry of the Brand Kit library.

## The flow

1. In the chat, open the **Brand Kit** picker next to the model and choose
   **Attach brand material…**. A native dialog selects the files. The chat
   lists them under **Brand material**.
2. Choose **Create Brand Kit and instructions**. The dialog lists every file,
   which previews and how much extracted text were prepared from it, and what
   the selected provider will receive. **Inspect the content prepared for
   analysis** shows each preview and its text.
3. Choose **Send listed content and analyze**. Nothing is sent before this.
4. Review the proposal. **Brand Kit** (data: colours, fonts, logo,
   descriptions) and **Project instructions** (guidance an agent follows) are
   separate sections, and both are editable. Evidence lists the file and slide
   each finding rests on, with its confidence.
5. Choose **Save and apply**, **Save to library**, or **Apply without saving**.

**Discard** asks before it drops a reviewed proposal. **Cancel analysis** stops
the run and keeps the attached files. **Remove** in the chat discards the
files. None of these change the project or the library.

## Supported files and limits

| Limit               | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| Files per selection | 8                                                         |
| Images              | PNG, JPEG, WebP, GIF (first frame), 10 MiB each           |
| Image dimensions    | 12,000 pixels per side and 40 megapixels                  |
| Decks               | PDF and PPTX, 32 MiB and 200 pages each                   |
| All files together  | 64 MiB                                                    |
| Prepared previews   | 24 across all files, each within 1280 pixels              |
| Extracted text      | 20,000 characters per slide, 200,000 in total             |
| Local preparation   | 90 seconds per rendered file, 3 minutes for the selection |
| Analysis            | 3 minutes; prepared previews and text within 22 MiB       |

Every limit is enforced in the main process. Sizes of all files are checked
before any file is processed, and the type of an image is taken from its
content, not its extension. A selection that breaks a limit attaches nothing;
files that were attached before stay attached.

Each image uses one preview. Decks share the remaining previews equally and
are sampled evenly, always including the first and last slide; the dialog
names the slides that were prepared and warns when a deck was sampled. PPTX
needs a local LibreOffice installation, as described in
[Brand Kit from deck](BRAND_KIT_FROM_DECK.md), which also lists the PPTX and
PDF content that is rejected. There is no OCR.

Choosing files again replaces the attached selection.

## Provider

The analysis uses the connected Claude Code provider with its `opus` alias,
through the same isolated invocation as deck analysis: inline image blocks
over stdin, no tools, no MCP servers, no session persistence. When Claude Code
is not available the dialog says so and the analysis cannot be started. No
other provider is used in its place. Builds that are not packaged also offer
the mock provider as an explicit choice; it returns a fixed demonstration and
does not look at the files.

## What leaves the computer

Selection, decoding and rendering are local. Uploaded images are decoded in
the disposable sandboxed renderer that also renders PDFs, never in the main
process. After **Send listed content and analyze**, the provider receives the
prepared previews, the text extracted from the listed slides, and extracted
PPTX logo candidates. Files are identified by number. File names, paths, the
original files, the open project and its assets are not sent.

The window never receives a path. It receives display names and the prepared
content.

## How the result is constrained

Uploaded content is reference data. The system prompt tells the agent to treat
it as untrusted evidence and not to follow anything written in it, and the
request marks it as such. The agent cannot act on it: the run has no tools.

The response is validated before it is shown:

- unknown fields, missing fields and values beyond the Brand Kit and
  instruction limits are rejected;
- every finding must cite prepared material, and the instructions need at
  least one finding of their own;
- a low-confidence finding requires an explanation in the reference notes;
- a logo may only be chosen from the offered candidates;
- URLs, file paths, credentials and commands are rejected everywhere,
  including in the instructions, because saved instructions later steer
  generations.

A response that fails any check is refused as a whole. Nothing of it is shown,
saved or applied.

Fonts are never presented as identified from appearance. Unless both proposed
font names occur in the extracted text, the review says that they are a
suggestion to check against the brand guidelines. A logo is used only when the
user selects one.

## Saving, applying and reuse

A saved profile is one entry of the Brand Kit library: the kit, its logo, the
instructions, and provenance (display names of the files, how much of each was
analyzed, provider, model and time). The entry is written in one atomic write,
so a kit is never saved without its instructions.

- **Save to library** does not change the project.
- **Save and apply** saves first. If saving fails, nothing is applied and the
  reviewed draft stays open for another attempt. If saving succeeds and
  applying fails, a message says that the profile is in the library and was
  not applied.
- **Apply without saving** changes the project only.

Applying replaces the Brand Kit, the logo and the instructions of the project
in one change. One **Undo** restores all three.

In another project, select the profile under **Brand Kit → Library** and
choose **Apply kit and instructions**, or **Apply kit only** to keep that
project's instructions. The Brand Kit picker in the chat marks such kits
“with instructions” and applies both.

Attached files and an unsaved proposal exist for the current project session
only. Replacing the project, or quitting, discards them.

## Limits of verification

Automated tests use the mock provider and stubbed native dialogs. They verify
preparation, disclosure, validation, saving, applying and undo, not what Opus
perceives in real brand material, Claude Code authentication, or the dialog of
the operating system. See
[the verification notes](../.agents/skills/verify-koma-motion/brand-profile.md).

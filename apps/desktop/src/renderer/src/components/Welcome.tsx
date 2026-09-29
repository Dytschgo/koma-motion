import type { ReactElement } from 'react';
import { createNewProject, openProject } from '../lib/projectActions';
import { Button } from './ui';

/**
 * Three frames of one circle on its way across the screen: the idea of the
 * application in a single picture.
 */
function Sequence(): ReactElement {
  const frames = [
    { x: 30, y: 72, r: 12 },
    { x: 60, y: 50, r: 20 },
    { x: 94, y: 40, r: 12 },
  ];
  return (
    <svg viewBox="0 0 420 96" className="w-full max-w-xl" aria-hidden="true" focusable="false">
      {frames.map((frame, index) => (
        <g key={index} transform={`translate(${String(index * 148)} 0)`}>
          <rect
            x="1"
            y="1"
            width="122"
            height="94"
            rx="6"
            fill="var(--color-desk-800)"
            stroke="var(--color-desk-500)"
          />
          {index > 0 && (
            <circle
              cx={frames[index - 1]?.x}
              cy={frames[index - 1]?.y}
              r={frames[index - 1]?.r}
              fill="none"
              stroke="var(--color-pencil-blue)"
              strokeDasharray="3 3"
            />
          )}
          <circle cx={frame.x} cy={frame.y} r={frame.r} fill="var(--color-pencil-red)" />
          {index < frames.length - 1 && (
            <path d="M128 48h16" stroke="var(--color-desk-500)" strokeWidth="1.5" />
          )}
        </g>
      ))}
    </svg>
  );
}

export function Welcome(): ReactElement {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-desk-950 p-8">
      <div className="flex max-w-xl flex-col items-start gap-6">
        <Sequence />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Presentations are frames. Make them move.
          </h1>
          <p className="mt-2 max-w-[60ch] text-lg text-ink-300">
            In Koma Motion a frame is called a Koma. Objects keep their identity from one Koma to
            the next, and the motion between them is part of the presentation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void createNewProject()}>
            Create a project
          </Button>
          <Button variant="outline" onClick={() => void openProject()}>
            Open a project
          </Button>
        </div>
        <p className="text-sm text-ink-400">
          Koma Motion is an early-stage prototype. Projects are stored on your computer as .koma
          files.
        </p>
      </div>
    </main>
  );
}

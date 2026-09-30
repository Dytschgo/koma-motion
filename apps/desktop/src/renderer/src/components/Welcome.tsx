import type { ReactElement } from 'react';
import { createNewProject, openProject } from '../lib/projectActions';
import { Button, Help } from './ui';

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
            rx="8"
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
    <main className="studio-welcome flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-desk-950 p-8">
      <div className="flex w-full max-w-2xl flex-col items-start gap-7">
        <div className="studio-welcome-sequence w-full rounded-2xl border border-desk-600/80 p-7 sm:p-9">
          <Sequence />
        </div>
        <div>
          <h1 className="max-w-[24ch] text-[2rem] leading-[1.14] font-semibold tracking-[-0.035em] text-ink-100">
            Presentations are frames. Make them move.
          </h1>
          <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-ink-300">
            Each frame is a Koma. Motion connects one Koma to the next.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => void createNewProject()}>
            Create a project
          </Button>
          <Button variant="outline" onClick={() => void openProject()}>
            Open a project
          </Button>
          <Help label="About Koma Motion project files">
            Koma Motion is an early prototype. Projects are stored on your computer as .koma files.
          </Help>
        </div>
      </div>
    </main>
  );
}

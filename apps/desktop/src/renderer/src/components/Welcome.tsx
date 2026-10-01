import type { ReactElement } from 'react';
import { createNewProject, createProjectFromStarter, openProject } from '../lib/projectActions';
import { StarterList } from './Starters';
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
            fill="var(--color-surface-2)"
            stroke="var(--color-line-strong)"
          />
          {index > 0 && (
            <circle
              cx={frames[index - 1]?.x}
              cy={frames[index - 1]?.y}
              r={frames[index - 1]?.r}
              fill="none"
              stroke="var(--color-accent)"
              strokeDasharray="3 3"
            />
          )}
          <circle cx={frame.x} cy={frame.y} r={frame.r} fill="var(--color-motion)" />
          {index < frames.length - 1 && (
            <path d="M128 48h16" stroke="var(--color-line-strong)" strokeWidth="1.5" />
          )}
        </g>
      ))}
    </svg>
  );
}

export function Welcome(): ReactElement {
  return (
    <main className="studio-desk flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-3xl flex-col items-start gap-8">
        <div className="w-full rounded-dialog border border-line bg-surface-1 p-7 shadow-raised sm:p-9">
          <Sequence />
        </div>
        <div>
          <p className="eyebrow text-accent">Koma Motion</p>
          <h1 className="mt-2 max-w-[22ch] text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.035em] text-ink-100">
            Presentations are frames. Make them move.
          </h1>
          <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-ink-300">
            Each frame is a Koma. Motion connects one Koma to the next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" className="px-5" onClick={() => void createNewProject()}>
            Create a project
          </Button>
          <Button variant="outline" className="px-5" onClick={() => void openProject()}>
            Open a project
          </Button>
          <Help label="About Koma Motion project files">
            Koma Motion is an early prototype. Projects are stored on your computer as .koma files.
          </Help>
        </div>
        <section aria-labelledby="starters-heading" className="flex w-full flex-col gap-3">
          <div>
            <h2 id="starters-heading" className="eyebrow">
              Or begin with a starter
            </h2>
            <p className="mt-1 text-sm text-pretty text-ink-400">
              Each starter brings a Brand Kit and instructions for richly animated Komas, and puts a
              first request into the chat. Choose a provider and send it.
            </p>
          </div>
          <StarterList
            actionLabel="Start"
            onChoose={(preset) => void createProjectFromStarter(preset)}
          />
        </section>
      </div>
    </main>
  );
}

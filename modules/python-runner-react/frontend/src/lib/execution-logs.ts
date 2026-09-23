export interface ExecutionOutputLog {
  type: string;
  content: string;
}

export interface OverviewExecutionOutputLog extends ExecutionOutputLog {
  execution_id: string;
  timestamp: string;
}

export function groupExecutionOutputStreams<T extends ExecutionOutputLog>(
  logs: readonly T[],
): T[] {
  const grouped = new Map<string, T>();

  for (const log of logs) {
    const previous = grouped.get(log.type);
    if (!previous) {
      grouped.set(log.type, log);
      continue;
    }

    grouped.set(log.type, {
      ...previous,
      content: `${previous.content}${previous.content.endsWith("\n") ? "" : "\n"}${log.content}`,
    });
  }

  return [...grouped.values()];
}

export function groupOverviewExecutionOutputs<
  T extends OverviewExecutionOutputLog,
>(logs: readonly T[]): T[] {
  const grouped = new Map<string, T>();

  for (const log of logs) {
    const key = JSON.stringify([log.execution_id, log.type, log.timestamp]);
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, log);
      continue;
    }

    grouped.set(key, {
      ...previous,
      content: `${previous.content}${previous.content.endsWith("\n") ? "" : "\n"}${log.content}`,
    });
  }

  return [...grouped.values()];
}

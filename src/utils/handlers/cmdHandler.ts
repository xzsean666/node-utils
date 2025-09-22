import { spawn } from 'child_process';

export async function runCommand(
  command: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    onStdout?: (data: string) => void; // 实时日志回调
    onStderr?: (data: string) => void;
  },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd || process.cwd(),
      env: { ...process.env, ...options?.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString(options?.encoding || 'utf-8');
      stdout += text;
      options?.onStdout?.(text); // 实时日志
    });

    child.stderr.on('data', (data) => {
      const text = data.toString(options?.encoding || 'utf-8');
      stderr += text;
      options?.onStderr?.(text); // 实时错误日志
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command "${command} ${args.join(' ')}" failed with code ${code}\n${stderr}`,
          ),
        );
      } else {
        resolve({ stdout, stderr, code: code ?? 0 });
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start command: ${err.message}`));
    });
  });
}

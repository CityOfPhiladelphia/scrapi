import type { RestAccumulator } from "@phila/philaroute/dist/types.d.ts";
import { execFileSync } from "child_process";


interface RunOptions { 
    script: string;
    env?: {
        [key: string]: string
    },
    envSelectorFn?: (acc: RestAccumulator) => Promise<Record<string, string>>;
};

const run = (opts: RunOptions) => async (acc: RestAccumulator): Promise<RestAccumulator> => {
    const { script, env = {} } = opts;
    const selector = opts.envSelectorFn ?? (async (_: RestAccumulator) => {})

    const result = execFileSync('npm run', [script], {
        shell: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            ...env,
            ...await selector(acc)
        }
    });

    acc.data = acc.data || {};
    acc.data[script] = result ? result.toString().trim() : null
    return acc;
}

export const script = {
    run,
};
/** Run the shipped-runtime acceptance suite against disposable synthetic vaults. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

export async function runAllTests(): Promise<void> {
    if (process.versions.electron) {
        throw new Error('Run this suite with Node: node test/acceptance.cjs');
    }
    const result = await promisify(execFile)(process.execPath, [path.join(__dirname, 'acceptance.cjs')], {
        cwd: path.join(__dirname, '..')
    });
    console.log(result.stdout);
}

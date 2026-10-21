import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
let count = 0;
async function inspect(path) {
  for (const entry of await readdir(new URL(path || '.', root), {withFileTypes:true})) {
    const name = join(path, entry.name);
    if (entry.isDirectory() && ['src','scripts','tests'].includes(name.split('/')[0])) await inspect(name);
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(name)) {
      const module = name.startsWith('src/frontend/') || name.startsWith('scripts/ui-preview/');
      const result = spawnSync(process.execPath, module ? ['--check','--input-type=module'] : ['--check',name],
        {cwd:root,input:module ? await readFile(new URL(name,root)) : undefined,encoding:'utf8'});
      if(result.status !== 0) {process.stderr.write(name+'\n'+result.stderr);process.exit(1);}
      count++;
    }
  }
}
await inspect('');
console.log(`Syntax lint passed: ${count} JavaScript modules.`);

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { STORE } from './runtime.mjs';

if (process.platform !== 'darwin') throw new Error('This background-service installer requires macOS');
const label = 'in.alphanova.telegram';
const directory = join(homedir(), 'Library/LaunchAgents');
const plist = join(directory, `${label}.plist`);
const root = fileURLToPath(new URL('../../', import.meta.url));
const escape = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
mkdirSync(directory, { recursive: true });
mkdirSync(STORE, { recursive: true, mode: 0o700 });
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(join(root, 'agents/telegram/runtime.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>45</integer>
<key>StandardOutPath</key><string>${escape(join(STORE, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(STORE, 'service.err.log'))}</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`, { mode: 0o600 });
const domain = `gui/${process.getuid()}`;
try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
console.log('Telegram signal service installed and started. It restarts at login and after a crash.');

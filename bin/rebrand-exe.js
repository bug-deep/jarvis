#!/usr/bin/env node
// Прописывает в Windows-exe нормальные иконку и версию вместо «Electron / GitHub».
// Нужно, чтобы приложение не выглядело как перепакованный Electron.
import fs from 'node:fs';
import * as ResEdit from 'resedit';

const [, , input, output, iconPath] = process.argv;
if (!input || !output) {
  console.error('usage: rebrand-exe.js <input.exe> <output.exe> [icon.ico]');
  process.exit(2);
}

const exe = ResEdit.NtExecutable.from(fs.readFileSync(input), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (versions.length === 0) throw new Error('в exe нет VersionInfo');

for (const info of versions) {
  info.setFileVersion(0, 1, 0, 0, 1033);
  info.setProductVersion(0, 1, 0, 0, 1033);
  info.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: 'Jarvis',
      FileDescription: 'Jarvis — ИИ-помощник на компьютере',
      FileVersion: '0.1.0',
      InternalName: 'Jarvis',
      LegalCopyright: '© 2026 Jarvis',
      OriginalFilename: 'Jarvis.exe',
      ProductName: 'Jarvis',
      ProductVersion: '0.1.0',
    },
  );
  info.outputToResourceEntries(res.entries);
}

if (iconPath && fs.existsSync(iconPath)) {
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconFile.icons.map((icon) => icon.data),
    );
  }
}

res.outputResource(exe);
fs.writeFileSync(output, Buffer.from(exe.generate()));
console.log(JSON.stringify({ ok: true, input, output }));

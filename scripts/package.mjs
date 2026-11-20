// Builds <name>-<version>.vsix from the compiled extension, without vsce or other dependencies.
// A .vsix is a zip: extension.vsixmanifest, [Content_Types].xml and the extension under extension/.
// Run via `npm run package` (compiles first).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Archive path → file contents. Only what the extension needs at runtime. */
const files = new Map([
    ['extension.vsixmanifest', manifest(pkg)],
    ['[Content_Types].xml', contentTypes()],
    ['extension/package.json', readFileSync(join(root, 'package.json'))],
    ['extension/README.md', readFileSync(join(root, 'README.md'))],
    ['extension/LICENSE.txt', readFileSync(join(root, 'LICENSE'))],
]);
for (const file of listFiles(join(root, 'out'))) {
    if (file.endsWith('.js')) files.set(`extension/${relative(root, file).split(sep).join('/')}`, readFileSync(file));
}

const output = `${pkg.name}-${pkg.version}.vsix`;
writeFileSync(join(root, output), zip(files));
console.log(`${output}: ${files.size} files`);

function manifest(p) {
    const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(p.name)}" Version="${xml(p.version)}" Publisher="${xml(p.publisher)}" />
    <DisplayName>${xml(p.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(p.description)}</Description>
    <Categories>${xml(p.categories.join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(p.engines.vscode)}" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes() {
    const types = { '.vsixmanifest': 'text/xml', '.json': 'application/json', '.js': 'application/javascript', '.md': 'text/markdown', '.txt': 'text/plain' };
    const defaults = Object.entries(types).map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}" />`);
    return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}</Types>\n`;
}

function listFiles(dir) {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name))
        .sort();
}

/** Minimal zip writer (deflate, no zip64): enough for a few small files. */
function zip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    // Fixed timestamp (1980-01-01) so the same sources give the same archive.
    const time = 0;
    const date = (1 << 5) | 1;
    for (const [name, content] of entries) {
        const data = Buffer.from(content);
        const packed = deflateRawSync(data);
        const nameBytes = Buffer.from(name, 'utf8');
        const crc = crc32(data);

        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4); // version needed
        header.writeUInt16LE(0x0800, 6); // UTF-8 names
        header.writeUInt16LE(8, 8); // deflate
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(packed.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBytes.length, 26);
        header.writeUInt16LE(0, 28); // extra length
        local.push(header, nameBytes, packed);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4); // version made by
        entry.writeUInt16LE(20, 6); // version needed
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt16LE(time, 12);
        entry.writeUInt16LE(date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(packed.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(nameBytes.length, 28);
        // extra, comment, disk, internal and external attributes stay 0
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBytes);

        offset += header.length + nameBytes.length + packed.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.size, 8);
    end.writeUInt16LE(entries.size, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, ...central, end]);
}

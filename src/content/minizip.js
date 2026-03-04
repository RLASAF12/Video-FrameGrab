// ============================================================
// Video FrameGrab — Minimal ZIP Builder
// Creates ZIP files (STORE method, no compression) in the
// browser. PNGs are already compressed, so STORE is optimal.
// ============================================================

const MiniZip = (() => {
    'use strict';

    function crc32(data) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function toBytes2(val) {
        return [val & 0xFF, (val >> 8) & 0xFF];
    }

    function toBytes4(val) {
        return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF];
    }

    function dosDateTime(date) {
        const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
        const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
        return { time, date: d };
    }

    function strToBytes(str) {
        const arr = [];
        for (let i = 0; i < str.length; i++) {
            arr.push(str.charCodeAt(i) & 0xFF);
        }
        return arr;
    }

    /**
     * Create a ZIP file from an array of { name: string, data: Uint8Array }
     * Returns a Blob of type application/zip.
     */
    function createZip(files) {
        const localHeaders = [];
        const centralHeaders = [];
        let offset = 0;
        const now = new Date();
        const dt = dosDateTime(now);

        for (const file of files) {
            const nameBytes = strToBytes(file.name);
            const crc = crc32(file.data);
            const size = file.data.length;

            // Local file header (30 bytes + name + data)
            const local = [].concat(
                [0x50, 0x4B, 0x03, 0x04],  // signature
                toBytes2(20),               // version needed
                toBytes2(0),                // general purpose flags
                toBytes2(0),                // compression: STORE
                toBytes2(dt.time),          // mod time
                toBytes2(dt.date),          // mod date
                toBytes4(crc),              // CRC-32
                toBytes4(size),             // compressed size
                toBytes4(size),             // uncompressed size
                toBytes2(nameBytes.length), // filename length
                toBytes2(0),                // extra field length
                nameBytes                   // filename
            );

            localHeaders.push({ header: new Uint8Array(local), data: file.data, offset });

            // Central directory header (46 bytes + name)
            const central = [].concat(
                [0x50, 0x4B, 0x01, 0x02],  // signature
                toBytes2(20),               // version made by
                toBytes2(20),               // version needed
                toBytes2(0),                // flags
                toBytes2(0),                // compression: STORE
                toBytes2(dt.time),          // mod time
                toBytes2(dt.date),          // mod date
                toBytes4(crc),              // CRC-32
                toBytes4(size),             // compressed size
                toBytes4(size),             // uncompressed size
                toBytes2(nameBytes.length), // filename length
                toBytes2(0),                // extra field length
                toBytes2(0),                // file comment length
                toBytes2(0),                // disk number start
                toBytes2(0),                // internal attributes
                toBytes4(0),                // external attributes
                toBytes4(offset),           // local header offset
                nameBytes                   // filename
            );

            centralHeaders.push(new Uint8Array(central));

            offset += local.length + file.data.length;
        }

        // End of central directory
        const centralDirOffset = offset;
        let centralDirSize = 0;
        for (const ch of centralHeaders) {
            centralDirSize += ch.length;
        }

        const eocd = [].concat(
            [0x50, 0x4B, 0x05, 0x06],       // signature
            toBytes2(0),                      // disk number
            toBytes2(0),                      // disk with central dir
            toBytes2(files.length),           // entries on this disk
            toBytes2(files.length),           // total entries
            toBytes4(centralDirSize),         // central dir size
            toBytes4(centralDirOffset),       // central dir offset
            toBytes2(0)                       // comment length
        );

        // Assemble the ZIP
        const parts = [];
        for (const lh of localHeaders) {
            parts.push(lh.header);
            parts.push(lh.data);
        }
        for (const ch of centralHeaders) {
            parts.push(ch);
        }
        parts.push(new Uint8Array(eocd));

        return new Blob(parts, { type: 'application/zip' });
    }

    return { createZip };
})();

// scripts/tile.js

// Import necessary modules.
const fs = require('fs');
const path = require('path');

// Import the Aseprite parser library.
const Aseprite = require('ase-parser');

// --- CONFIGURATION ---
const TILE_SIZE = 512; // The size of our square tiles (e.g., 512x512 pixels).

// --- PATHS ---
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const publicDir = path.join(process.cwd(), 'public');
const tilesDir = path.join(publicDir, 'tiles');
const manifestPath = path.join(publicDir, 'manifest.json');

try {
    // --- Step 1: Read and parse the Aseprite file ---
    console.log(`Reading file from: ${sourcePath}`);
    const buffer = fs.readFileSync(sourcePath);
    console.log('Parsing Aseprite data...');
    const ase = new Aseprite(buffer);
    ase.parse();
    
    if (!ase.frames || ase.frames.length === 0) {
        throw new Error('No frames found in the Aseprite file.');
    }

    // --- Step 2: Composite the final frame from its cels ---
    console.log('Compositing frame from cels...');
    const finalImageData = Buffer.alloc(ase.width * ase.height * 4);
    const frame = ase.frames[0];
    const sortedCels = frame.cels.sort((a, b) => a.layerIndex - b.layerIndex);

    for (const cel of sortedCels) {
        if (!cel.rawCelData) continue;
        for (let y = 0; y < cel.h; y++) {
            for (let x = 0; x < cel.w; x++) {
                const sourceIndex = (y * cel.w + x) * 4;
                const r = cel.rawCelData[sourceIndex];
                const g = cel.rawCelData[sourceIndex + 1];
                const b = cel.rawCelData[sourceIndex + 2];
                const a = cel.rawCelData[sourceIndex + 3];
                if (a > 0) {
                    const destX = cel.xpos + x;
                    const destY = cel.ypos + y;
                    if (destX >= 0 && destX < ase.width && destY >= 0 && destY < ase.height) {
                        const destIndex = (destY * ase.width + destX) * 4;
                        finalImageData.set([r, g, b, a], destIndex);
                    }
                }
            }
        }
    }

    // --- Step 3: Create output directories ---
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
    if (!fs.existsSync(tilesDir)) fs.mkdirSync(tilesDir);

    // --- Step 4: Slice the final image into binary tiles ---
    console.log(`Slicing image into ${TILE_SIZE}x${TILE_SIZE} tiles...`);
    for (let y = 0; y < ase.height; y += TILE_SIZE) {
        for (let x = 0; x < ase.width; x += TILE_SIZE) {
            const tileBuffer = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
            // Copy pixels from the full image to the tile buffer
            for (let row = 0; row < TILE_SIZE; row++) {
                const sourceY = y + row;
                if (sourceY >= ase.height) break;

                const sourceStartIndex = ((sourceY * ase.width) + x) * 4;
                const sourceEndIndex = sourceStartIndex + (TILE_SIZE * 4);
                const destStartIndex = (row * TILE_SIZE) * 4;
                
                finalImageData.copy(tileBuffer, destStartIndex, sourceStartIndex, sourceEndIndex);
            }
            const tilePath = path.join(tilesDir, `tile_${y}_${x}.bin`);
            fs.writeFileSync(tilePath, tileBuffer);
        }
    }
    console.log('Tiling complete.');

    // --- Step 5: Create the manifest file ---
    const manifest = {
        width: ase.width,
        height: ase.height,
        tileSize: TILE_SIZE
    };
    console.log(`Writing manifest to: ${manifestPath}`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    console.log('Conversion successful!');

} catch (error) {
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}

// scripts/convert.js

// Import necessary modules.
const fs = require('fs');
const path = require('path');

// Import the Aseprite parser library.
const Aseprite = require('ase-parser');

// Define the paths for our input and output files.
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const publicDir = path.join(process.cwd(), 'public');
const jsonOutputPath = path.join(publicDir, 'canvas.json');
const binOutputPath = path.join(publicDir, 'canvas.bin');

try {
    // --- Step 1: Read the Aseprite file ---
    console.log(`Reading file from: ${sourcePath}`);
    const buffer = fs.readFileSync(sourcePath);

    // --- Step 2: Parse the file data ---
    console.log('Parsing Aseprite data...');
    const ase = new Aseprite(buffer);
    ase.parse();
    
    // --- Step 3: Check for valid data ---
    if (!ase.frames || ase.frames.length === 0) {
        throw new Error('No frames found in the Aseprite file.');
    }

    // --- Step 4: Composite the final frame from its cels ---
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
                        finalImageData[destIndex] = r;
                        finalImageData[destIndex + 1] = g;
                        finalImageData[destIndex + 2] = b;
                        finalImageData[destIndex + 3] = a;
                    }
                }
            }
        }
    }

    // --- Step 5: Create metadata object ---
    console.log('Creating metadata file...');
    const metaData = {
        width: ase.width,
        height: ase.height,
    };

    // --- Step 6: Ensure the output directory exists ---
    if (!fs.existsSync(publicDir)){
        fs.mkdirSync(publicDir);
    }

    // --- Step 7: Write the metadata and binary files ---
    console.log(`Writing JSON metadata to: ${jsonOutputPath}`);
    fs.writeFileSync(jsonOutputPath, JSON.stringify(metaData));

    console.log(`Writing binary pixel data to: ${binOutputPath}`);
    fs.writeFileSync(binOutputPath, finalImageData);

    console.log('Conversion successful!');

} catch (error) {
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}

// scripts/convert.js

// Import necessary modules.
const fs = require('fs');
const path = require('path');

// Import the Aseprite parser library.
const Aseprite = require('ase-parser');

// Define the paths for our input and output files.
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const outputPath = path.join(process.cwd(), 'public', 'canvas.json');
const publicDir = path.join(process.cwd(), 'public');

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
    
    // Create a new buffer for our final image, filled with transparent pixels.
    const finalImageData = Buffer.alloc(ase.width * ase.height * 4);

    const frame = ase.frames[0];
    
    // Sort cels by their layer index to ensure correct drawing order (bottom to top).
    const sortedCels = frame.cels.sort((a, b) => a.layerIndex - b.layerIndex);

    // Iterate over each cel (layer) and "draw" it onto our final image buffer.
    for (const cel of sortedCels) {
        // A cel might not have image data (e.g., if it's an empty layer).
        if (!cel.rawCelData) {
            continue;
        }

        // Iterate over each pixel of the current cel.
        for (let y = 0; y < cel.h; y++) {
            for (let x = 0; x < cel.w; x++) {
                // Calculate the position of the source pixel in the cel's data buffer.
                const sourceIndex = (y * cel.w + x) * 4;
                
                // --- FINAL FIX: The actual pixel data is in 'rawCelData' ---
                const r = cel.rawCelData[sourceIndex];
                const g = cel.rawCelData[sourceIndex + 1];
                const b = cel.rawCelData[sourceIndex + 2];
                const a = cel.rawCelData[sourceIndex + 3];

                // If the pixel is not fully transparent, draw it.
                if (a > 0) {
                    // Calculate the position of the destination pixel in our final image buffer.
                    const destX = cel.xpos + x;
                    const destY = cel.ypos + y;
                    
                    // Ensure we don't draw outside the main canvas bounds.
                    if (destX >= 0 && destX < ase.width && destY >= 0 && destY < ase.height) {
                        const destIndex = (destY * ase.width + destX) * 4;
                        
                        // For simplicity, we just copy the pixel. For real blending, more complex math is needed.
                        // But for most Aseprite files, this overwrite method works perfectly.
                        finalImageData[destIndex] = r;
                        finalImageData[destIndex + 1] = g;
                        finalImageData[destIndex + 2] = b;
                        finalImageData[destIndex + 3] = a;
                    }
                }
            }
        }
    }

    // --- Step 5: Format the final data for our application ---
    console.log('Formatting data for output...');
    const outputData = {
        width: ase.width,
        height: ase.height,
        frames: [
            {
                pixels: Array.from(finalImageData)
            }
        ]
    };

    // --- Step 6: Ensure the output directory exists ---
    if (!fs.existsSync(publicDir)){
        fs.mkdirSync(publicDir);
    }

    // --- Step 7: Write the JSON file ---
    console.log(`Writing JSON to: ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(outputData));

    console.log('Conversion successful!');

} catch (error) {
    // If anything goes wrong, log the error and exit with a failure code.
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}

// scripts/convert.js

// Import necessary modules.
const fs = require('fs');
const path = require('path');

// --- FIX ---
// Import the NEW, more reliable Aseprite parser library.
const parseAse = require('ase-parser');

// Define the paths for our input and output files.
const sourcePath = path.join(process.cwd(), 'source', 'canvas.aseprite');
const outputPath = path.join(process.cwd(), 'public', 'canvas.json');
const publicDir = path.join(process.cwd(), 'public');

try {
    // --- Step 1: Read the Aseprite file ---
    console.log(`Reading file from: ${sourcePath}`);
    const buffer = fs.readFileSync(sourcePath);

    // --- Step 2: Parse the file data using the new library ---
    console.log('Parsing Aseprite data...');
    const ase = parseAse(buffer);
    
    // --- Step 3: Check for valid data ---
    if (!ase.frames || ase.frames.length === 0) {
        throw new Error('No frames found in the Aseprite file.');
    }

    // --- Step 4: Format the data for our application ---
    console.log('Formatting data for output...');
    const frame = ase.frames[0];
    const outputData = {
        width: ase.width,
        height: ase.height,
        frames: [
            {
                // The 'pixels' property from this library is a Buffer.
                // We convert it to a regular Array for JSON serialization.
                pixels: Array.from(frame.pixels)
            }
        ]
    };

    // --- Step 5: Ensure the output directory exists ---
    if (!fs.existsSync(publicDir)){
        fs.mkdirSync(publicDir);
    }

    // --- Step 6: Write the JSON file ---
    console.log(`Writing JSON to: ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(outputData));

    console.log('Conversion successful!');

} catch (error) {
    // If anything goes wrong, log the error and exit with a failure code.
    console.error('An error occurred during conversion:', error);
    process.exit(1);
}

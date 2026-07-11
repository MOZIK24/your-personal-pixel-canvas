declare module 'ase-parser' {
  export default class Aseprite {
    constructor(buffer: Buffer, name?: string);
    parse(): void;
    frames: Array<{
      cels: Array<{
        xpos: number;
        ypos: number;
        w: number;
        h: number;
        rawCelData?: Buffer;
        layerIndex: number;
      }>;
      frameDuration?: number;
    }>;
    width: number;
    height: number;
  }
}

export type ChemicalElement =
  | 'H'
  | 'Be'
  | 'B'
  | 'C'
  | 'N'
  | 'O'
  | 'F'
  | 'Si'
  | 'P'
  | 'S'
  | 'Cl'
  | 'Br'
  | 'I'
  | 'Xe';
export type ChemicalPosition = [number, number, number];
export type ChemistrySource = {
  purpose: 'generate' | 'reproduce';
  showLabels: boolean;
  showLonePairs: boolean;
  labelTint?: boolean;
  colorCoding?: 'none' | 'identity' | 'property';
  annotations?: (
    | { kind: 'label'; text: string; position: ChemicalPosition }
    | {
        kind: 'line';
        from: ChemicalPosition;
        to: ChemicalPosition;
        color?: string;
        dashed?: boolean;
      }
  )[];
} & (
  | {
      kind: 'molecule';
      style: 'explicit' | 'skeletal' | 'ball-stick';
      layout: 'pinned' | 'chain' | 'ring';
      atoms: {
        id: string;
        element: ChemicalElement;
        position?: ChemicalPosition;
        hydrogens: number;
        charge: number;
        lonePairs?: number;
      }[];
      bonds: {
        from: string;
        to: string;
        order: 1 | 2 | 3;
        stereo: 'plain' | 'wedge' | 'dash';
      }[];
    }
  | {
      kind: 'vsepr';
      center: ChemicalElement;
      ligands: ChemicalElement[];
      bondOrders?: (1 | 2 | 3)[];
      lonePairs: number;
      charge: number;
    }
  | {
      kind: 'dna';
      sequence: string;
      form: 'ladder' | 'helix';
      labelEvery?: number;
    }
  | { kind: 'peptide'; sequence: string; form: 'chain' | 'helix' | 'sheet' }
);
export type GraphExpression = {
  id: string;
  expression: string;
  color: string;
  visible: boolean;
  slider?: { min: number; max: number; step: number };
  playback?: { duration?: number; loop?: boolean; reverse?: boolean };
  pointRadius?: number;
  parameters?: Partial<
    Record<'t' | 'theta' | 'u' | 'v', { min: number; max: number }>
  >;
};
export type GraphDocument = {
  dimension: 2 | 3;
  construction?: string;
  chemistry?: ChemistrySource;
  presentation?: {
    preset?: 'coordinate' | 'geometry' | 'data';
    grid?: boolean;
    axes?: Partial<Record<'x' | 'y' | 'z', boolean>>;
    labels?: Partial<Record<'x' | 'y' | 'z', string>>;
  };
  expressions: GraphExpression[];
  bounds: { min: number; max: number; y?: { min: number; max: number } };
  angleMode: 'radians' | 'degrees';
  tables?: GraphTable[];
};
export type GraphTable = {
  id: string;
  x: string;
  y: string;
  rows: [number, number][];
  color: string;
  visible: boolean;
};
export type Plot = {
  id: string;
  color: string;
  kind: 'line' | 'surface' | 'point';
  positions: number[];
  normals?: number[];
  radius?: number;
  opacity?: number;
  width?: number;
};
export type GraphResult = {
  plots: Plot[];
  errors: Record<string, string>;
  values: Record<string, string>;
  parameters: string[];
  labels?: {
    text: string;
    position: [number, number, number];
    anchored?: boolean;
    scientific?: boolean;
    sequenceIndex?: number;
    badgeColor?: string;
    tintColor?: string;
  }[];
  electronPairs?: {
    position: [number, number, number];
    vertical: boolean;
    atomPosition?: ChemicalPosition;
  }[];
  notes?: string[];
  legend?: { text: string; color: string }[];
};

export type GraphCamera = {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
};

export function generatedFiles(dir?: string): Promise<string[]>;
export function buildPages(options?: { outDir?: string; contentDir?: string; requireAllStates?: boolean }): Promise<{ pages: Array<{ path: string; title: string; description: string }>; urls: string[]; features: string[]; states: number }>;

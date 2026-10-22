// Side-effect/asset imports handled by esbuild loaders.
declare module '*.css';
declare module '*.woff2' { const url: string; export default url; }

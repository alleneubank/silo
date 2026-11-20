// Bun file assets: the import's value is the asset's path (see src/core/janitor.ts).
declare module "*/janitor" {
  const assetPath: string;
  export default assetPath;
}

// Allow importing .xml files as raw text strings (bundled by esbuild's text loader).
declare module "*.xml" {
  const content: string;
  export default content;
}

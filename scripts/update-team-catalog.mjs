import { updateCatalogs } from "./team-catalog.mjs";

const selection = process.argv[2] || "all";
const results = await updateCatalogs(selection);
console.log(JSON.stringify(results));

import { updateCatalogs } from "./team-catalog.mjs";

const selection = process.argv[2] || "all";
const results = await updateCatalogs(selection);
results.forEach(result => console.log(`Updated ${result.sport}: ${result.count} teams`));

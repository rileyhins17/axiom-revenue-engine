console.error("Deployment is on hold until the app is finished and Riley explicitly approves the exact release.");
console.error("Hosted previews, staging and production are blocked. Local builds, tests and no-upload dry runs remain available.");
console.error("There is no command-line or environment override. See docs/RUNBOOK.md for the owner deployment hold.");
process.exitCode = 1;

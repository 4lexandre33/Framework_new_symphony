import { bootstrap } from "./app/bootstrap";

function startApplication(): void {
  void bootstrap();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApplication, {
    once: true,
  });
} else {
  startApplication();
}
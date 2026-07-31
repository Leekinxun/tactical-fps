import "./styles.css";
import { App } from "./app/App";

const host = document.querySelector<HTMLDivElement>("#app");

if (!host) {
  throw new Error("Application host was not found.");
}

const app = new App(host);
void app.mount();

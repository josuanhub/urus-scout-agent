import fetch from "node-fetch";
import { CONFIG } from "../config.js";

export async function publishPost(content) {
  await fetch("https://moltbook.com/api/v1/posts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CONFIG.MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });
}

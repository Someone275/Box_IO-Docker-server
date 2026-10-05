import { createServer } from "node:http";
import { deliverWebhook, webhookParts, webhookRequest } from "../src/webhook-template.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(webhookParts("72, kitchen, on").join("|") === "72|kitchen|on", "comma fields are trimmed");

const post = webhookRequest({
  url: "https://example.com/hook?src=box",
  method: "POST",
  data: '{"temp":"{1}","room":"{2}","raw":"{value}"}',
  value: '72,kit "a",on',
});
assert(post.ok, "post builds");
if (post.ok) {
  assert(post.call.method === "POST", "post method");
  assert(post.call.body === '{"temp":"72","room":"kit \\"a\\"","raw":"72,kit \\"a\\",on"}', `json body ${post.call.body}`);
  assert(post.call.contentType === "application/json", "json content type is inferred from the template");
  assert(post.call.url === "https://example.com/hook?src=box", "url placeholders stay in the url");
}

const get = webhookRequest({
  url: "https://example.com/hook",
  method: "get",
  data: "temp={1}&room={2}",
  value: "72,north room",
});
assert(get.ok, "get builds");
if (get.ok) {
  assert(get.call.url === "https://example.com/hook?temp=72&room=north+room", `get url ${get.call.url}`);
  assert(get.call.body === undefined, "get has no body");
}

const inUrl = webhookRequest({
  url: "https://example.com/hook/{1}?room={2}",
  method: "PUT",
  data: "{value}",
  value: "pump,west",
});
assert(inUrl.ok, "put builds");
if (inUrl.ok) {
  assert(inUrl.call.url === "https://example.com/hook/pump?room=west", `put url ${inUrl.call.url}`);
  assert(inUrl.call.body === "pump,west", `put body ${inUrl.call.body}`);
}

const plain = webhookRequest({
  url: "https://example.com/hook",
  method: "POST",
  contentType: "text/plain",
  data: "note={1}",
  value: 'say "hi"',
});
assert(plain.ok && plain.call.body === 'note=say "hi"' && plain.call.contentType === "text/plain;charset=utf-8", "plain text keeps the characters");

const form = webhookRequest({
  url: "https://example.com/hook",
  method: "POST",
  contentType: "application/x-www-form-urlencoded",
  data: "temp={1}&room={2}",
  value: "72,north room",
});
assert(form.ok && form.call.body === "temp=72&room=north+room" && form.call.contentType === "application/x-www-form-urlencoded", `form body ${form.ok ? form.call.body : ""}`);

const formAmp = webhookRequest({
  url: "https://example.com/hook",
  method: "PUT",
  contentType: "application/x-www-form-urlencoded",
  data: "q={1}",
  value: "a&b=c",
});
assert(formAmp.ok && formAmp.call.body === "q=a%26b%3Dc", `form encodes separators ${formAmp.ok ? formAmp.call.body : ""}`);

const forcedJson = webhookRequest({
  url: "https://example.com/hook",
  method: "POST",
  contentType: "application/json",
  data: '{"room":"{1}"}',
  value: 'north "room"',
});
assert(forcedJson.ok && forcedJson.call.body === '{"room":"north \\"room\\""}', "json content type escapes quotes");

assert(webhookRequest({ url: "ftp://example.com", method: "GET", value: "1" }).ok === false, "ftp is rejected");
assert(webhookRequest({ url: "", method: "POST", value: "1" }).ok === false, "empty url is rejected");

const hits: { url?: string; method?: string; type?: string; body: string }[] = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    hits.push({
      url: req.url,
      method: req.method,
      type: req.headers["content-type"],
      body: Buffer.concat(chunks).toString("utf8"),
    });
    res.writeHead(204);
    res.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const sent = webhookRequest({
  url: `http://127.0.0.1:${port}/hook`,
  method: "POST",
  contentType: "application/x-www-form-urlencoded",
  data: "reading={1}",
  value: "42,extra",
});
assert(sent.ok, "local post builds");
if (sent.ok) {
  const status = await deliverWebhook(sent.call);
  assert(status === "204 POST", `status ${status}`);
}
assert(
  hits.length === 1 && hits[0].body === "reading=42" && hits[0].type === "application/x-www-form-urlencoded",
  JSON.stringify(hits),
);
server.close();

console.log("webhook helpers ok");

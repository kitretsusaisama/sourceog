import { json } from "sourceog";

export function GET(context: { params: Record<string, string | string[]>; locale?: string }) {
  return json({
    message: "Hello from SourceOG API routes",
    params: context.params,
    locale: context.locale ?? "en"
  });
}

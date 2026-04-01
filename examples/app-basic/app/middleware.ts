import { text, type SourceOGMiddleware } from "sourceog";

const middleware: SourceOGMiddleware = async (context, next) => {
  if (context.request.url.pathname === "/forbidden") {
    return text("Forbidden", { status: 403 });
  }

  return next();
};

export default middleware;

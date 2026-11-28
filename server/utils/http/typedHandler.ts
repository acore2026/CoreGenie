const { reqBody, queryParams } = require("./index");

export interface TypedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  raw: Record<string, any>;
  body: TBody;
  query: TQuery;
  params: TParams;
}

export interface TypedHandlerSchemas<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  body?: {
    safeParse: (
      input: unknown
    ) =>
      | { success: true; data: TBody }
      | { success: false; error: { issues?: Array<{ message?: string }> } };
  };
  query?: {
    safeParse: (
      input: unknown
    ) =>
      | { success: true; data: TQuery }
      | { success: false; error: { issues?: Array<{ message?: string }> } };
  };
  params?: {
    safeParse: (
      input: unknown
    ) =>
      | { success: true; data: TParams }
      | { success: false; error: { issues?: Array<{ message?: string }> } };
  };
  errorFormat?: "error" | "message";
}

function firstIssueMessage(
  error: { issues?: Array<{ message?: string }> } | undefined,
  fallback: string
): string {
  return error?.issues?.[0]?.message || fallback;
}

function typedHandler<TBody = unknown, TQuery = unknown, TParams = unknown>(
  schemas: TypedHandlerSchemas<TBody, TQuery, TParams>,
  handler: (
    ctx: TypedRequest<TBody, TQuery, TParams>,
    response: Record<string, any>
  ) => Promise<unknown> | unknown
) {
  const errorKey = schemas.errorFormat || "error";

  return async (
    request: Record<string, any>,
    response: Record<string, any>
  ) => {
    let parsedBody: TBody = reqBody(request) as TBody;
    let parsedQuery: TQuery = queryParams(request) as TQuery;
    let parsedParams: TParams = (request.params || {}) as TParams;

    if (schemas.body) {
      const result = schemas.body.safeParse(parsedBody);
      if (!result.success) {
        const msg = firstIssueMessage(result.error, "Invalid request body.");
        return response
          .status(400)
          .json(
            errorKey === "message"
              ? { message: msg }
              : { success: false, error: msg }
          );
      }
      parsedBody = result.data;
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(parsedQuery);
      if (!result.success) {
        const msg = firstIssueMessage(
          result.error,
          "Invalid query parameters."
        );
        return response
          .status(400)
          .json(
            errorKey === "message"
              ? { message: msg }
              : { success: false, error: msg }
          );
      }
      parsedQuery = result.data;
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(parsedParams);
      if (!result.success) {
        const msg = firstIssueMessage(result.error, "Invalid path parameters.");
        return response
          .status(400)
          .json(
            errorKey === "message"
              ? { message: msg }
              : { success: false, error: msg }
          );
      }
      parsedParams = result.data;
    }

    return handler(
      {
        raw: request,
        body: parsedBody,
        query: parsedQuery,
        params: parsedParams,
      },
      response
    );
  };
}

module.exports = {
  typedHandler,
};

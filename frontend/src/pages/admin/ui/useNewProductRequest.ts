import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** Consume the All Products creation request once; closing the dialog stays closed. */
export function useNewProductRequest(open: () => void) {
  const [params, setParams] = useSearchParams();
  const callback = useRef(open);
  callback.current = open;
  useEffect(() => {
    if (params.get("new") !== "1") return;
    callback.current();
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [params, setParams]);
}

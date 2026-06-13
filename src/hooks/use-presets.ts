"use client";

import { useLocalStorage } from "./use-local-storage";
import { LS_KEYS, DEFAULT_SUPPLIERS, DEFAULT_PRODUCTS } from "@/lib/constants";

/**
 * 자주 쓰는 매입처/상품명 프리셋 (localStorage 저장, 회선/세무 페이지에서 편집).
 */
export function usePresets() {
  const [suppliers, setSuppliers, h1] = useLocalStorage<string[]>(
    LS_KEYS.suppliers,
    DEFAULT_SUPPLIERS,
  );
  const [products, setProducts, h2] = useLocalStorage<string[]>(
    LS_KEYS.products,
    DEFAULT_PRODUCTS,
  );

  function addSupplier(name: string) {
    const v = name.trim();
    if (v && !suppliers.includes(v)) setSuppliers([...suppliers, v]);
  }
  function removeSupplier(name: string) {
    setSuppliers(suppliers.filter((s) => s !== name));
  }
  function addProduct(name: string) {
    const v = name.trim();
    if (v && !products.includes(v)) setProducts([...products, v]);
  }
  function removeProduct(name: string) {
    setProducts(products.filter((p) => p !== name));
  }

  return {
    suppliers,
    products,
    addSupplier,
    removeSupplier,
    addProduct,
    removeProduct,
    hydrated: h1 && h2,
  };
}

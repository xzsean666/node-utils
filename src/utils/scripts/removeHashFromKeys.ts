function removeHashFromKeys(data: any) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key.split("#").pop(), value])
  );
}

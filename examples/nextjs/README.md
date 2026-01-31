# OrbitRelay SDK Examples

## Next.js Basic

```ts
const relay = new OrbitRelay({ ... });

const result = await relay.request({
  url,
  jsonPath,
});

console.log(result.value);

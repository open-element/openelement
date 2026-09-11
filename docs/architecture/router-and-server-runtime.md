# Router and server runtime

App owns pages, routes, loaders, actions, and request orchestration. The Vite adapter
owns compilation and build integration; Nitro owns the supported Node and Workers
server output path. Element-local rendering mechanics do not leak into App's public
contract.

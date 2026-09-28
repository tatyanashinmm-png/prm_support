# Собираем статику Vite-приложения, отдаём через nginx — лёгкий и надёжный
# способ раздавать SPA, без Node.js в проде.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# VITE_API_URL читается на этапе сборки (npm run build), не в рантайме —
# должен быть задан либо в frontend/.env перед сборкой, либо через build arg.
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

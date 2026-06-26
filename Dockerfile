# Optional container build for Evolution OS (App Platform can also build from
# source with the Node buildpack — see .do/app.yaml). Use this if you deploy
# via a Dockerfile (App Platform, a Droplet, or any container host).

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# Bring the built app + production deps.
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js

EXPOSE 3000
ENV PORT=3000
# next start honors PORT; the mission worker boots on the first /api/missions request.
CMD ["npm", "start"]

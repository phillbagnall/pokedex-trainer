FROM node:22-alpine
WORKDIR /app
COPY index.mjs .
ENV PORT=8791
EXPOSE 8791
VOLUME ["/app/data"]
CMD ["node", "index.mjs"]

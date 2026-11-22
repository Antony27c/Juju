# juju: servidor Node sin dependencias. Sirve para Railway y para cualquier hosting con contenedores.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
# El directorio turístico vive en la raíz; el servidor y la página, en chatbot/.
COPY estructura.json jujuy_turismo.json ./
COPY chatbot ./chatbot
EXPOSE 3000
CMD ["node", "chatbot/server.mjs"]

FROM python:3.13-slim

WORKDIR /opt/bees-knowledge-worker
COPY pyproject.toml ./
COPY bees_knowledge_worker ./bees_knowledge_worker
RUN pip install --no-cache-dir .

EXPOSE 8788
ENTRYPOINT ["bees-knowledge-worker", "serve", "--host", "0.0.0.0", "--port", "8788", "--config", "/etc/bees-knowledge/config.json"]


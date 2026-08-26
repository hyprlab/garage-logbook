FROM python:3.12-slim
LABEL maintainer="Hyprlab"
LABEL description="Garage Logbook - Car Maintenance Tracker"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/hyprlab/garage-logbook"
LABEL org.opencontainers.image.version="0.3.2"
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /data/uploads/cars /data/uploads/maintenance
ENV DATABASE_PATH=/data/garage_logbook.db
ENV UPLOAD_FOLDER=/data/uploads
ENV SECRET_KEY=change-me-in-docker-compose
ENV PYTHONUNBUFFERED=1
EXPOSE 5000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "--timeout", "120", "app:app"]

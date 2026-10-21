"""AWS Lambda entry point (Function URL events, payload format 2.0)."""

import logging

from mangum import Mangum

from .main import app

logging.getLogger().setLevel(logging.INFO)

handler = Mangum(app, lifespan="off")

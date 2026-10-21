"""User-facing errors. Messages are safe to show in the UI and never include stack traces."""


class AppError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class DataError(AppError):
    """The uploaded file or the requested analysis cannot be processed."""

    status_code = 422

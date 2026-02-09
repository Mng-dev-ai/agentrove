from app.services.exceptions import SchedulerException


def scheduler_exception_status(exc: SchedulerException, default: int = 400) -> int:
    if "not found" in str(exc).lower():
        return 404
    return default

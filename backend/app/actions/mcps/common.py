import re

SAFE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\\-\\.]+$")
MAX_MCPS_PER_USER = 20

from app.domain.enums import CasePhase


class InvalidTransitionError(Exception):
    def __init__(self, from_phase: CasePhase, to_phase: CasePhase) -> None:
        self.from_phase = from_phase
        self.to_phase = to_phase
        super().__init__(f"Cannot transition {from_phase} → {to_phase}")


class CaseNotFoundError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Case '{case_code}' not found")


class UnknownCaseCodeError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Unknown case code '{case_code}'")


class LowConfidenceError(Exception):
    def __init__(self, score: float) -> None:
        self.score = score
        super().__init__(f"Confidence score {score:.2f} below threshold")


class DelayReasonNotRequiredError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Case '{case_code}' does not require a delay reason")


class RoomNotFoundError(Exception):
    def __init__(self, room_code: str) -> None:
        self.room_code = room_code
        super().__init__(f"Room '{room_code}' not found")


class RoomOccupiedError(Exception):
    def __init__(self, room_code: str, active_case_code: str) -> None:
        self.room_code = room_code
        self.active_case_code = active_case_code
        super().__init__(f"Room '{room_code}' is already occupied by case '{active_case_code}'")


class AdminAuthError(Exception):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"Admin '{username}' authentication failed")


class DeviceAuthError(Exception):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"Device '{username}' not authorized")


class NurseAuthError(Exception):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"Nurse '{username}' authentication failed")


class CaseFrozenError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Case '{case_code}' has a pending cancellation request and is frozen")


class CancellationAlreadyRequestedError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Case '{case_code}' already has a pending cancellation request")


class CancellationNotRequestedError(Exception):
    def __init__(self, case_code: str) -> None:
        self.case_code = case_code
        super().__init__(f"Case '{case_code}' has no pending cancellation request")

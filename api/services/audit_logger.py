"""Simple Audit Logger - Writes all events to database"""
import uuid
import traceback
from datetime import datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from models import AuditLog


class AuditLogger:
    """Centralized audit logging to database"""

    @staticmethod
    async def log(
        db: AsyncSession,
        event_type: str,
        event_name: str,
        message: str,
        severity: str = "info",
        user_id: Optional[uuid.UUID] = None,
        tenant_id: Optional[uuid.UUID] = None,
        patient_id: Optional[uuid.UUID] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_method: Optional[str] = None,
        request_path: Optional[str] = None,
        request_id: Optional[str] = None,
        duration_ms: Optional[int] = None,
        status_code: Optional[int] = None,
        details: Optional[dict] = None,
        error_type: Optional[str] = None,
        error_message: Optional[str] = None,
        stack_trace: Optional[str] = None,
        contains_phi: bool = False,
        success: bool = True,
        commit: bool = True
    ):
        """
        Log an event to audit_logs table

        Args:
            event_type: Category (auth, api, mdt, patient_access, file, database)
            event_name: Specific event (login, upload, extraction_success)
            message: Human-readable description
            severity: debug, info, warning, error, critical
            commit: Whether to commit immediately (False for batch logging)
        """
        log_entry = AuditLog(
            event_type=event_type,
            event_name=event_name,
            severity=severity,
            user_id=user_id,
            tenant_id=tenant_id,
            patient_id=patient_id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_method=request_method,
            request_path=request_path,
            request_id=request_id,
            duration_ms=duration_ms,
            status_code=status_code,
            message=message,
            details=details,
            error_type=error_type,
            error_message=error_message,
            stack_trace=stack_trace,
            contains_phi=contains_phi,
            success=success
        )

        db.add(log_entry)

        if commit:
            await db.commit()

    @staticmethod
    async def log_auth(
        db: AsyncSession,
        event_name: str,
        message: str,
        username: str,
        success: bool,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        details: Optional[dict] = None
    ):
        """Log authentication events"""
        await AuditLogger.log(
            db=db,
            event_type="auth",
            event_name=event_name,
            message=message,
            severity="warning" if not success else "info",
            ip_address=ip_address,
            user_agent=user_agent,
            details={**(details or {}), "username": username},
            success=success
        )

    @staticmethod
    async def log_api_request(
        db: AsyncSession,
        request_method: str,
        request_path: str,
        status_code: int,
        duration_ms: int,
        user_id: Optional[uuid.UUID] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None
    ):
        """Log API requests"""
        severity = "error" if status_code >= 500 else "warning" if status_code >= 400 else "info"
        success = status_code < 400

        await AuditLogger.log(
            db=db,
            event_type="api",
            event_name="request",
            message=f"{request_method} {request_path} - {status_code}",
            severity=severity,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_method=request_method,
            request_path=request_path,
            request_id=request_id,
            duration_ms=duration_ms,
            status_code=status_code,
            success=success
        )

    @staticmethod
    async def log_mdt_extraction(
        db: AsyncSession,
        file_name: str,
        status: str,
        duration_ms: int,
        observations_count: int,
        model: str,
        user_id: Optional[uuid.UUID] = None,
        patient_id: Optional[uuid.UUID] = None,
        error_message: Optional[str] = None,
        stack_trace: Optional[str] = None
    ):
        """Log MDT extraction events"""
        success = status == "success"
        severity = "error" if not success else "info"

        await AuditLogger.log(
            db=db,
            event_type="mdt",
            event_name=f"extraction_{status}",
            message=f"MDT extraction {status}: {file_name} - {observations_count} observations",
            severity=severity,
            user_id=user_id,
            patient_id=patient_id,
            duration_ms=duration_ms,
            details={
                "file_name": file_name,
                "observations_count": observations_count,
                "model": model
            },
            error_message=error_message,
            stack_trace=stack_trace,
            contains_phi=True,
            success=success
        )

    @staticmethod
    async def log_patient_access(
        db: AsyncSession,
        action: str,
        resource_type: str,
        user_id: uuid.UUID,
        patient_id: uuid.UUID,
        resource_id: Optional[uuid.UUID] = None,
        details: Optional[dict] = None
    ):
        """Log patient data access (HIPAA compliance)"""
        await AuditLogger.log(
            db=db,
            event_type="patient_access",
            event_name=action,
            message=f"User {user_id} {action} {resource_type} for patient {patient_id}",
            severity="info",
            user_id=user_id,
            patient_id=patient_id,
            details={
                "resource_type": resource_type,
                "resource_id": str(resource_id) if resource_id else None,
                **(details or {})
            },
            contains_phi=True,
            success=True
        )

    @staticmethod
    async def log_error(
        db: AsyncSession,
        event_type: str,
        event_name: str,
        message: str,
        exception: Exception,
        user_id: Optional[uuid.UUID] = None,
        patient_id: Optional[uuid.UUID] = None,
        request_path: Optional[str] = None,
        details: Optional[dict] = None
    ):
        """Log errors with full stack trace"""
        await AuditLogger.log(
            db=db,
            event_type=event_type,
            event_name=event_name,
            message=message,
            severity="error",
            user_id=user_id,
            patient_id=patient_id,
            request_path=request_path,
            error_type=type(exception).__name__,
            error_message=str(exception),
            stack_trace=traceback.format_exc(),
            details=details,
            success=False
        )

    @staticmethod
    async def log_file_operation(
        db: AsyncSession,
        operation: str,
        file_name: str,
        file_size: int,
        user_id: uuid.UUID,
        patient_id: Optional[uuid.UUID] = None,
        success: bool = True,
        error_message: Optional[str] = None
    ):
        """Log file upload/download/delete operations"""
        await AuditLogger.log(
            db=db,
            event_type="file",
            event_name=operation,
            message=f"File {operation}: {file_name} ({file_size} bytes)",
            severity="error" if not success else "info",
            user_id=user_id,
            patient_id=patient_id,
            details={
                "file_name": file_name,
                "file_size": file_size
            },
            error_message=error_message,
            contains_phi=True,
            success=success
        )

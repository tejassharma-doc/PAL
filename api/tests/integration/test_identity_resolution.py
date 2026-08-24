"Test identity resolution for DocEHR integration"
import pytest
import asyncio
from sqlalchemy import select
from services.fastmcp_client import IdentityResolver, IdentityResolutionError, IDValidator
from models import Doctor, Clinic, PhoneUser
from database import get_db

@pytest.fixture
async def db_session():
    "Get database session"
    async for db in get_db():
        yield db

@pytest.fixture
async def test_data(db_session):
    "Create test data"
    # Create test clinics
    sunset = Clinic(
        name=Sunset Clinic,
        external_id=docehr-sunset-456,
        address=123 Main St,
        is_active=True
    )
    apollo = Clinic(
        name=Apollo Hospital,
        external_id=docehr-apollo-789,
        address=456 Oak Ave,
        is_active=True
    )
    
    db_session.add(sunset)
    db_session.add(apollo)
    await db_session.flush()
    
    # Create test doctors
    dr_arjun_mehta = Doctor(
        full_name=Dr. Arjun Mehta,
        external_id=docehr-dr-arjun-mehta-123,
        specialization=Cardiology,
        clinic_id=sunset.id,
        is_active=True
    )
    dr_arjun_singh = Doctor(
        full_name=Dr. Arjun Singh,
        external_id=docehr-dr-arjun-singh-456,
        specialization=Orthopedics,
        clinic_id=sunset.id,
        is_active=True
    )
    dr_priya = Doctor(
        full_name=Dr. Priya Sharma,
        external_id=docehr-dr-priya-789,
        specialization=Pediatrics,
        clinic_id=apollo.id,
        is_active=True
    )
    
    db_session.add(dr_arjun_mehta)
    db_session.add(dr_arjun_singh)
    db_session.add(dr_priya)
    await db_session.commit()
    
    return {
        sunset: sunset,
        apollo: apollo,
        dr_arjun_mehta: dr_arjun_mehta,
        dr_arjun_singh: dr_arjun_singh,
        dr_priya: dr_priya
    }

@pytest.mark.asyncio
async def test_exact_doctor_match(db_session, test_data):
    "Test exact match for doctor name"
    resolver = IdentityResolver(db_session)
    
    # Should match exactly
    doctor_id, info = await resolver.resolve_doctor(
        Dr. Arjun Mehta,
        clinic_name=Sunset Clinic
    )
    
    assert doctor_id == docehr-dr-arjun-mehta-123
    assert info[full_name] == Dr. Arjun Mehta
    assert info[specialization] == Cardiology

@pytest.mark.asyncio
async def test_ambiguous_doctor_match(db_session, test_data):
    "Test ambiguous match should raise error with candidates"
    resolver = IdentityResolver(db_session)
    
    with pytest.raises(IdentityResolutionError) as exc_info:
        await resolver.resolve_doctor(
            Dr. Arjun,  # Ambiguous - matches both Mehta and Singh
            clinic_name=Sunset Clinic
        )
    
    error = exc_info.value
    assert len(error.candidates) == 2
    assert Multiple doctors found in str(error)

@pytest.mark.asyncio
async def test_doctor_not_found(db_session, test_data):
    "Test doctor not found should raise error"
    resolver = IdentityResolver(db_session)
    
    with pytest.raises(IdentityResolutionError) as exc_info:
        await resolver.resolve_doctor(
            Dr. Nonexistent,
            clinic_name=Sunset Clinic
        )
    
    assert No doctor found in str(exc_info.value)

@pytest.mark.asyncio
async def test_fuzzy_doctor_match(db_session, test_data):
    "Test fuzzy matching (without Dr. prefix)"
    resolver = IdentityResolver(db_session)
    
    # Should match via ILIKE
    doctor_id, info = await resolver.resolve_doctor(
        Arjun Mehta,  # Missing Dr. prefix
        clinic_name=Sunset Clinic
    )
    
    assert doctor_id == docehr-dr-arjun-mehta-123
    assert info[full_name] == Dr. Arjun Mehta

@pytest.mark.asyncio
async def test_clinic_context_filtering(db_session, test_data):
    "Test that doctor is resolved within clinic context"
    resolver = IdentityResolver(db_session)
    
    # Dr. Priya is only at Apollo, not at Sunset
    with pytest.raises(IdentityResolutionError):
        await resolver.resolve_doctor(
            Dr. Priya Sharma,
            clinic_name=Sunset Clinic  # Wrong clinic
        )
    
    # Should work at Apollo
    doctor_id, info = await resolver.resolve_doctor(
        Dr. Priya Sharma,
        clinic_name=Apollo Hospital
    )
    assert doctor_id == docehr-dr-priya-789

@pytest.mark.asyncio
async def test_clinic_resolution(db_session, test_data):
    "Test clinic name resolution"
    resolver = IdentityResolver(db_session)
    
    # Exact match
    clinic_id, info = await resolver.resolve_clinic(Sunset Clinic)
    assert clinic_id == docehr-sunset-456
    assert info[name] == Sunset Clinic
    
    # Fuzzy match
    clinic_id, info = await resolver.resolve_clinic(Sunset)
    assert clinic_id == docehr-sunset-456

def test_id_validation():
    "Test ID validator"
    validator = IDValidator()
    
    # Valid doctor ID
    validator.validate_doctor_id(
        docehr-dr-123,
        {full_name: Dr. Test}
    )
    
    # Invalid doctor ID (None)
    with pytest.raises(ValidationError):
        validator.validate_doctor_id(None, {full_name: Dr. Test})
    
    # Invalid doctor ID (empty string)
    with pytest.raises(ValidationError):
        validator.validate_doctor_id(", {full_name: Dr. Test})
    
    # Incomplete doctor info
    with pytest.raises(ValidationError):
        validator.validate_doctor_id(docehr-dr-123, {})

if __name__ == __main__:
    pytest.main([__file__, -v])

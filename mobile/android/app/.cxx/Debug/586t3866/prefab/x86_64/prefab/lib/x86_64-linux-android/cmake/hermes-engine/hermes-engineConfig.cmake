if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/admin/.gradle/caches/8.10.2/transforms/fdaa5402bcc0ced1a41564cf0c7b8969/transformed/jetified-hermes-android-0.76.9-debug/prefab/modules/libhermes/libs/android.x86_64/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/admin/.gradle/caches/8.10.2/transforms/fdaa5402bcc0ced1a41564cf0c7b8969/transformed/jetified-hermes-android-0.76.9-debug/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()


# ghost-path: the path a ghost drives, from Kinoko (https://github.com/vabold/Kinoko, MIT).
# Built by scripts/build-ghost-path.ts with g++ 13 or newer, as Kinoko needs.
cmake_minimum_required(VERSION 3.10)
project(GhostPath CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(KINOKO_DIR "" CACHE PATH "Kinoko's source")
file(GLOB_RECURSE KINOKO_SOURCES CONFIGURE_DEPENDS ${KINOKO_DIR}/source/*.cc)
list(FILTER KINOKO_SOURCES EXCLUDE REGEX ".*/host/(main|KReplaySystem|KTestSystem)\.cc$")

add_executable(ghost-path main.cc ${KINOKO_SOURCES})
target_include_directories(ghost-path SYSTEM PRIVATE ${KINOKO_DIR}/include ${KINOKO_DIR}/source)
target_compile_options(ghost-path PRIVATE -DREVOLUTION -fcheck-new -fno-asynchronous-unwind-tables
    -fno-exceptions -fno-rtti -fshort-wchar -O2 -Wno-delete-non-virtual-dtor -Wno-packed-bitfield-compat)
# One file to ship, with nothing else to install.
target_link_options(ghost-path PRIVATE -static -s)
